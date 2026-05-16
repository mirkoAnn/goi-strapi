"use strict";

async function up() {
  if (!global.strapi?.db) {
    throw new Error("Strapi instance is not available in migration context.");
  }

  const strapiInstance = global.strapi;
  const updated = await strapiInstance.db
    .getConnection("slots_cmps")
    .where({
      field: "dynamic_content",
      component_type: "common.paragraph-with-figure",
    })
    .update({
      field: "dynamicContent",
    });

  strapiInstance.log.info(
    `[slot migration] Updated ${updated} slots_cmps rows from dynamic_content to dynamicContent.`,
  );
}

module.exports = { up };
