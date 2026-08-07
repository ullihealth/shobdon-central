-- Independent per-state rotation durations for RightInfoPanel.tsx's
-- carousel (ops card / notamsFull page / notices page), matching the
-- pattern LeftInfoPanel.tsx already uses (0021's
-- weatherSummaryStateADurationSeconds/B) - a recursive-setTimeout
-- carousel where each state reads its own duration, rather than the
-- single shared setInterval notamsCarouselIntervalSeconds currently
-- drives all three states with (see RightInfoPanel.tsx's own comment on
-- that setInterval).
--
-- notamsCarouselIntervalSeconds is deliberately left in place, untouched,
-- for now - RightInfoPanel.tsx still reads it until the new fields are
-- wired up and confirmed working end-to-end, at which point it can be
-- retired in a follow-up migration. Not removed or renamed here.
--
-- Defaults all match notamsCarouselIntervalSeconds's own existing
-- fallback (5s) - this migration is a zero-visible-change addition on
-- its own; behavior only changes once RightInfoPanel.tsx is updated to
-- read these instead.
ALTER TABLE ops_panel_state ADD COLUMN notamsOpsDurationSeconds INTEGER NOT NULL DEFAULT 5;
ALTER TABLE ops_panel_state ADD COLUMN notamsFullDurationSeconds INTEGER NOT NULL DEFAULT 5;
ALTER TABLE ops_panel_state ADD COLUMN noticesDurationSeconds INTEGER NOT NULL DEFAULT 5;
