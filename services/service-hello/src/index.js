import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'service-hello' });
});

app.get('/hello', (req, res) => {
  res.json({ message: 'Hello, World!', service: 'service-hello' });
});

app.listen(PORT, () => {
  console.log(`service-hello running on port ${PORT}`);
});
