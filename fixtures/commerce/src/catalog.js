export const products = [{ id: 'book', name: 'Fixture book', price: 1200 }];
export function catalog(req, res) { res.json(products); }
