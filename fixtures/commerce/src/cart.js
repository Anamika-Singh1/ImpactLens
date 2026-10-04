import { products } from './catalog.js';
export function cart(req, res) {
  const item = products.find(p => p.id === req.body.productId);
  if (!item || !Number.isInteger(req.body.quantity) || req.body.quantity < 1) return res.sendStatus(400);
  res.json({ userId: req.user.id, productId: item.id, quantity: req.body.quantity });
}
