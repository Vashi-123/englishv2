-- Drop chat_progress: app derives completion/progress from chat_messages only.

DROP TABLE IF EXISTS chat_progress CASCADE;

