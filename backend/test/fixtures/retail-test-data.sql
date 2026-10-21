INSERT INTO retail_transactions (
  source_row, invoice_no, stock_code, description, quantity,
  invoice_date, unit_price, customer_id, country
) VALUES
  (2, 'TEST-1001', 'P-A', 'Product A', 10, '2025-06-02 09:00:00', 10.00, '10001', 'United Kingdom'),
  (3, 'TEST-1002', 'P-B', 'Product B', 5, '2025-06-03 10:00:00', 10.00, '10002', 'France'),
  (4, 'TEST-1003', 'P-C', 'Product C', 1, '2025-06-04 11:00:00', 5.00, NULL, 'United Kingdom'),
  (5, 'C-TEST-1004', 'P-A', 'Product A', -2, '2025-06-05 12:00:00', 10.00, '10001', 'United Kingdom'),
  (6, 'TEST-1005', 'P-B', 'Product B', 2, '2025-06-09 13:00:00', 10.00, '10003', 'France');