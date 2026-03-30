const { logger } = require('@librechat/data-schemas');
const { SystemRoles } = require('librechat-data-provider');
const { findUser, createUser } = require('~/models');

/**
 * Axata Auto-Authentication Middleware
 *
 * Reads user context injected by the reverse proxy (X-Axata-* headers),
 * finds or creates the corresponding LibreChat user, and attaches it to req.user.
 * When req.user is set here, requireJwtAuth skips its own passport check.
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

    logger.debug(`[axataAuth] Authenticated: ${axataUser} (${user.id})`);
    next();
  } catch (err) {
    logger.error(`[axataAuth] Error authenticating ${axataUser}: ${err.message}`);
    next();
  }
};

module.exports = axataAuth;
