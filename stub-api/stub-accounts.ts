import express from 'express';

function mockAccounts(app: express.Application, _config: { stubApiPort: string, adminPort: string }) {
  app.get('/users/some-user/documents', (_req, res) => {
    res.send(JSON.stringify([]));
  });
};

export default mockAccounts;