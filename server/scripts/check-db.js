let client;
try {
  const databaseModule = await import('../src/db.js');
  client = databaseModule.client;
  await client.connect();
  await databaseModule.checkDatabase();
  await databaseModule.checkSchema();
  console.log('MongoDB connection successful. Required collections and indexes are available.');
} catch (error) {
  console.error(error.isConfigurationError ? error.message : 'MongoDB check failed. Check Atlas access and run npm run db:migrate.');
  process.exitCode = 1;
} finally {
  await client?.close();
}
