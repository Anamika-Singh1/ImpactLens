export function authenticated(req, res, next) {
  if (req.headers.authorization !== 'Bearer fixture-user') return res.sendStatus(401);
  req.user = { id: 'user-1' };
  next();
}
