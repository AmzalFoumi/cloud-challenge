import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'service-orders' });
});

app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, Orders!', service: 'service-orders' });
});

app.get('/orders', (req, res) => {
  res.json([
    { id: 1, userId: 1, productId: 2, quantity: 3 },
    { id: 2, userId: 2, productId: 1, quantity: 1 },
  ]);
});

app.listen(PORT, () => {
  console.log(`service-orders running on port ${PORT}`);
});
