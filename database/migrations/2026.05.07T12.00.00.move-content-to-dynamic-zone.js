"use strict";

async function up() {
  // This migration was executed during the content-to-dynamic-zone rollout.
  // It remains as a no-op so fresh environments do not depend on the retired
  // common.content component or its legacy table shape.
}

module.exports = { up };
