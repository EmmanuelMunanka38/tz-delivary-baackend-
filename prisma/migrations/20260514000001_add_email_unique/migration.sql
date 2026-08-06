-- Add unique constraint on email field
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
