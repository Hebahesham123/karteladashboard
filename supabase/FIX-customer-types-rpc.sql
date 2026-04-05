-- Create a function that returns all distinct customer types
-- This avoids the 1000-row SELECT limit
CREATE OR REPLACE FUNCTION get_distinct_customer_types()
RETURNS TABLE(customer_type text)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT DISTINCT c.customer_type
  FROM clients c
  WHERE c.customer_type IS NOT NULL
    AND c.customer_type <> ''
  ORDER BY c.customer_type;
$$;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION get_distinct_customer_types() TO authenticated;
GRANT EXECUTE ON FUNCTION get_distinct_customer_types() TO anon;
