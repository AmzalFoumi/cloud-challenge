import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'service-users' });
});

app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, Users!', service: 'service-users' });
});

app.get('/users', (req, res) => {
  res.json([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]);
});

app.listen(PORT, () => {
  console.log(`service-users running on port ${PORT}`);
});
