-- Five deterministic seeded users for local testing and demos.
-- Fixed UUIDs make it easy to copy IDs into API calls and Swagger examples.
INSERT INTO users (id, name, email)
VALUES
  ('11111111-1111-4111-8111-111111111111', 'Aarav Sharma', 'aarav.sharma@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'Priya Patel', 'priya.patel@example.com'),
  ('33333333-3333-4333-8333-333333333333', 'Rahul Verma', 'rahul.verma@example.com'),
  ('44444444-4444-4444-8444-444444444444', 'Sneha Iyer', 'sneha.iyer@example.com'),
  ('55555555-5555-4555-8555-555555555555', 'Vikram Singh', 'vikram.singh@example.com')
ON CONFLICT (email) DO UPDATE
  SET name = EXCLUDED.name;
