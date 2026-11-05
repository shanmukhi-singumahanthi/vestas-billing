import app from './app.js';
import { getDb } from './db.js';

const PORT = process.env.PORT || 4000;

getDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Vestas Pharmaceuticals Backend API running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize PostgreSQL database:', err);
    process.exit(1);
  });
