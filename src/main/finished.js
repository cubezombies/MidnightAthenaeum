'use strict';

/**
 * Single source of truth for the auto-computed "finished" threshold, shared
 * between the main process (progress:save) and the renderer (flushProgress)
 * via preload's contextBridge — the two previously duplicated this literal
 * independently, risking the renderer's optimistic state disagreeing with
 * what actually gets persisted.
 */
const FINISHED_TAIL_SECONDS = 30;

function isFinishedByPosition(position, duration) {
  return duration ? position >= duration - FINISHED_TAIL_SECONDS : false;
}

module.exports = { FINISHED_TAIL_SECONDS, isFinishedByPosition };
