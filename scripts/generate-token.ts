import { closePool } from '../src/config/database';
import { signUserToken } from '../src/utils/jwt';
import { userRepository } from '../src/modules/users/user.repository';

/**
 * Usage: npm run token -- user@example.com
 * Prints a JWT for a seeded user so the API can be exercised with curl/Postman.
 */
async function main(): Promise<void> {
  const email = process.argv[2];

  if (!email) {
    console.error('Usage: npm run token -- <email>');
    process.exitCode = 1;
    return;
  }

  const user = await userRepository.findByEmail(email);

  if (!user) {
    console.error(`[token] no user found for ${email}. Run "npm run seed" first.`);
    process.exitCode = 1;
    return;
  }

  const token = signUserToken({ id: user.id, email: user.email });

  console.log(`User:  ${user.name} <${user.email}>`);
  console.log(`ID:    ${user.id}`);
  console.log(`Token: ${token}`);
}

main()
  .catch((error: unknown) => {
    console.error('[token] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
