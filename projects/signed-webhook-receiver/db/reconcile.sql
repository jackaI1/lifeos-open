-- Orders for which the intake event never completed, and dead events needing attention.
SELECT e.id, e.status, e.last_error FROM events e LEFT JOIN orders o ON o.id = e.payload->'data'->>'order_id' WHERE e.type = 'order.created' AND (o.id IS NULL OR e.status <> 'done');
SELECT event_id, error, failed_at FROM dead_letters ORDER BY failed_at;
