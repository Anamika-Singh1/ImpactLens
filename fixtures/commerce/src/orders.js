export function orders(req, res) { res.json([{ id: 'order-1', userId: req.user.id, status: 'paid' }]); }
