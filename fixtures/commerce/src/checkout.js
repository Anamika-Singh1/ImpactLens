import { total } from './pricing.js';
export function checkout(req, res) {
  const { price, quantity } = req.body;
  if (!Number.isInteger(price) || price < 0 || !Number.isInteger(quantity) || quantity < 1) return res.sendStatus(400);
  res.json({ userId: req.user.id, total: total(price, quantity), status: 'paid' });
}
