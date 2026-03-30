const { createClient } = require('redis');
const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { findUser, createUser } = require('~/models');

const REDIS_URL = process.env.REDIS_URL || 'redis://:axata_redis_pass@localhost:6379/0';
const MCP_USER_KEY_PREFIX = 'axa:user_mcp:';

let redisClient = null;

async function getRedis() {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }
  redisClient = createClient({ url: REDIS_URL });
  redisClient.on('error', (err) => logger.warn(`[axataAuth] Redis error: ${err.message}`));
  await redisClient.connect();
  return redisClient;
}

/**
 * Axata Auto-Authentication Middleware
 *
 * Reads user context injected by the reverse proxy (X-Axata-* headers),
 * finds or creates the corresponding LibreChat user, and attaches it to req.user.
 * Also maps the LibreChat user ID to the Axata session ID in Redis so the
 * MCP server can look up per-user DB credentials.
 */
const axataAuth = async (req, res, next) => {
  if (req.user) {
    return next();
  }

  const axataUser = req.headers['x-axata-user'];
  if (!axataUser) {
    return next();
  }

  try {
    const email = `${axataUser.toLowerCase()}@axata.local`;

    let user = await findUser({ email });

    if (!user) {
      user = await createUser({
        email,
        name: axataUser,
        username: axataUser.toLowerCase(),
        provider: 'axata',
        role: SystemRoles.USER,
        emailVerified: true,
      });

      user = await findUser({ email });
      logger.info(`[axataAuth] Created LibreChat user for: ${axataUser}`);
    }

    if (!user) {
      logger.error(`[axataAuth] Could not find or create user for: ${axataUser}`);
      return next();
    }

    user.id = user._id.toString();
    req.user = user;

    // Map LibreChat user ID → Axata session ID so the MCP server can look up DB credentials
    const axaSession = req.cookies?.axa_session;
    if (axaSession) {
      try {
        const redis = await getRedis();
        await redis.set(`${MCP_USER_KEY_PREFIX}${user.id}`, axaSession, { EX: 86400 });
        logger.debug(`[axataAuth] Mapped MCP session for ${axataUser} (${user.id})`);
      } catch (redisErr) {
        logger.warn(`[axataAuth] Could not write MCP session mapping: ${redisErr.message}`);
      }
    }

    logger.debug(`[axataAuth] Authenticated: ${axataUser} (${user.id})`);
    next();
  } catch (err) {
    logger.error(`[axataAuth] Error authenticating ${axataUser}: ${err.message}`);
    next();
  }
};

module.exports = axataAuth;
