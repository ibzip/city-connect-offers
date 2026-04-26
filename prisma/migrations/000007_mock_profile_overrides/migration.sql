-- Add transient profile overrides (walking tolerance, max stops, declared
-- intent, etc.) carried by an active mock context profile. These are applied
-- on top of the user's persisted UserProfile when the dev simulator activates
-- a profile, but never overwrite the user's saved preferences.

ALTER TABLE "MockContextProfile" ADD COLUMN "profileOverridesJson" TEXT;
