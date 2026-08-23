-- Bug fix: unblocklisting a subscriber didn't restore their list memberships
-- that blocklistSubscriber() had force-unsubscribed, even though that
-- unsubscribe was a side effect of blocklisting, not a genuine opt-out. This
-- column remembers each membership's status right before blocklisting force-
-- unsubscribed it, so unblocklistSubscriber() can restore exactly those (and
-- only those) -- a membership the subscriber had already unsubscribed from
-- themselves, before ever being blocklisted, is left alone either way.

ALTER TABLE subscriber_lists
    ADD COLUMN pre_blocklist_status TEXT
        CHECK (pre_blocklist_status IN ('unconfirmed', 'confirmed', 'unsubscribed'));
