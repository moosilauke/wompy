-- Wompy migration 0029: per-user "always load remote images" preference.
--
-- "View original" renders a message's real HTML. Remote images in that HTML
-- are blocked by default, because loading one tells the sender that this
-- specific person opened this specific message at this time — the URL carries
-- a per-recipient token.
--
-- Blocking is blanket rather than heuristic, deliberately. Filtering "1x1
-- tracking pixels" does not work: the SENDER declares the dimensions, so a
-- tracker simply writes width="100" and serves a 1x1. Measured across 7,348
-- HTML messages in a real mailbox: 1,551 carry a remote image while declaring
-- no 1x1 anywhere, 2,386 size images via CSS, 1,185 hide them with
-- display:none, and 669 track via a CSS background-image that is not an <img>
-- tag at all. Verifying real dimensions requires fetching the image, which is
-- the event being avoided. (The ROADMAP also lists pixel-vs-photo
-- classification as a deliberate non-goal.)
--
-- Some people would rather have their mail simply look right. This is that
-- switch. It governs images only — it never relaxes sanitization.
--
-- Default false: the privacy-preserving behaviour is what you get without
-- making a choice, and the ~2% who care can opt out.

alter table profiles
  add column if not exists always_load_images boolean not null default false;
