import React from 'react';
export function Authentication() { return React.createElement('button', null, 'Sign in'); }
export function ProductCatalog() { return React.createElement('h1', null, 'Product catalog'); }
export function Cart() { return React.createElement('h1', null, 'Cart'); }
export function Checkout() { return React.createElement('h1', null, 'Checkout'); }
export function OrderHistory() { return React.createElement('h1', null, 'Order history'); }
export function Commerce({ page = 'catalog' }) {
  const components = { authentication: Authentication, catalog: ProductCatalog, cart: Cart, checkout: Checkout, orders: OrderHistory };
  return React.createElement(components[page] ?? ProductCatalog);
}
