"use strict";

const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const componentService = require(
  path.join(
    projectRoot,
    "node_modules",
    "@strapi",
    "core",
    "dist",
    "services",
    "document-service",
    "components.js",
  ),
);
const modelTransform = require(
  path.join(
    projectRoot,
    "node_modules",
    "@strapi",
    "core",
    "dist",
    "utils",
    "transform-content-types-to-models.js",
  ),
);

const SLOT_UID = "api::slot.slot";
const PARAGRAPH_COMPONENT = "common.paragraph";
const DYNAMIC_CONTENT_FIELD = "dynamicContent";

function normalizeBlocks(blocks) {
  return Array.isArray(blocks) ? blocks : [];
}

async function createComponentEntry(strapiInstance, componentUid, data) {
  const schema = strapiInstance.getModel(componentUid);
  const componentData = await componentService.createComponents(
    componentUid,
    data,
  );
  const entryData = componentService.assignComponentData(
    schema,
    componentData,
    data,
  );

  return strapiInstance.db.query(componentUid).create({
    data: entryData,
  });
}

async function appendDynamicZoneComponent(strapiInstance, slotId, componentId) {
  const identifiers = strapiInstance.db.metadata.identifiers;
  const slotSchema = strapiInstance.getModel(SLOT_UID);
  const joinTableName = modelTransform.getComponentJoinTableName(
    slotSchema.collectionName,
    identifiers,
  );
  const entityIdColumn =
    modelTransform.getComponentJoinColumnEntityName(identifiers);
  const componentIdColumn =
    modelTransform.getComponentJoinColumnInverseName(identifiers);
  const componentTypeColumn =
    modelTransform.getComponentTypeColumn(identifiers);
  const fieldColumn = identifiers.FIELD_COLUMN;
  const orderColumn = identifiers.ORDER_COLUMN;

  const existingOrderRow = await strapiInstance.db
    .getConnection(joinTableName)
    .where({
      [entityIdColumn]: slotId,
      [fieldColumn]: DYNAMIC_CONTENT_FIELD,
    })
    .max({ maxOrder: orderColumn })
    .first();

  const nextOrder = Number(existingOrderRow?.maxOrder ?? 0) + 1;

  await strapiInstance.db.getConnection(joinTableName).insert({
    [entityIdColumn]: slotId,
    [componentIdColumn]: componentId,
    [componentTypeColumn]: PARAGRAPH_COMPONENT,
    [fieldColumn]: DYNAMIC_CONTENT_FIELD,
    [orderColumn]: nextOrder,
  });
}

async function up() {
  if (!global.strapi?.db) {
    throw new Error("Strapi instance is not available in migration context.");
  }

  const strapiInstance = global.strapi;

  const slots = await strapiInstance.db.query(SLOT_UID).findMany({
    select: ["id", "opinionContent"],
    populate: {
      dynamicContent: {},
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const slot of slots) {
    const opinionBlocks = normalizeBlocks(slot.opinionContent);
    if (!opinionBlocks.length) {
      skipped += 1;
      continue;
    }

    // Create new paragraph component
    const paragraphComponent = {
      content: opinionBlocks,
    };
    const createdComponent = await createComponentEntry(
      strapiInstance,
      PARAGRAPH_COMPONENT,
      paragraphComponent,
    );

    await appendDynamicZoneComponent(
      strapiInstance,
      slot.id,
      createdComponent.id,
    );

    updated += 1;
  }

  strapiInstance.log.info(
    `[slot migration] Appended ${updated} opinionContent blocks as common.paragraph; skipped ${skipped}.`,
  );
}

module.exports = { up };
