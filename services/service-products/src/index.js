import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'service-products' });
});

app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, Products!', service: 'service-products' });
});

app.get('/products', (req, res) => {
  res.json([
    { id: 1, name: 'Widget', price: 9.99 },
    { id: 2, name: 'Gadget', price: 19.99 },
  ]);
});

app.listen(PORT, () => {
  console.log(`service-products running on port ${PORT}`);
});
