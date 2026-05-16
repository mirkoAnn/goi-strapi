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
const TARGET_COMPONENT = "common.paragraph-with-figure";
const DYNAMIC_CONTENT_FIELD = "dynamicContent";

function getMediaId(media) {
  if (!media) return null;
  if (typeof media === "number") return media;
  if (typeof media === "string") return media;
  if (typeof media === "object" && typeof media.id === "number")
    return media.id;
  if (typeof media === "object" && typeof media.id === "string")
    return media.id;
  return null;
}

function getEntityId(value) {
  if (typeof value === "number" || typeof value === "string") return value;
  if (value && typeof value === "object") {
    if (typeof value.id === "number" || typeof value.id === "string") {
      return value.id;
    }
  }

  return null;
}

function normalizeBlocks(blocks) {
  return Array.isArray(blocks) ? blocks : [];
}

function normalizeFigure(figure) {
  if (!figure || typeof figure !== "object") return null;

  const normalized = {
    image: getMediaId(figure.image),
    mobileImage: getMediaId(figure.mobileImage),
    description:
      typeof figure.description === "string" ? figure.description : null,
  };

  const hasFigureData =
    normalized.image !== null ||
    normalized.mobileImage !== null ||
    (normalized.description !== null && normalized.description.trim() !== "");

  if (!hasFigureData) return null;

  return {
    image: normalized.image,
    mobileImage: normalized.mobileImage,
    description: normalized.description,
  };
}

function stableStringify(value) {
  return JSON.stringify(value ?? null);
}

function hasEquivalentParagraphWithFigure(dynamicContent, bonusBlocks, figure) {
  if (!Array.isArray(dynamicContent)) return false;

  const expectedBonus = normalizeBlocks(bonusBlocks);
  const expectedFigure = normalizeFigure(figure);

  return dynamicContent.some((item) => {
    if (!item || item.__component !== TARGET_COMPONENT) return false;

    const existingBonus = normalizeBlocks(item.content?.content);
    const existingFigure = normalizeFigure(item.figure);

    return (
      stableStringify(existingBonus) === stableStringify(expectedBonus) &&
      stableStringify(existingFigure) === stableStringify(expectedFigure)
    );
  });
}

function buildParagraphWithFigure(bonusBlocks, figure) {
  const next = {
    __component: TARGET_COMPONENT,
    imageSide: "right",
    content: {
      content: normalizeBlocks(bonusBlocks),
    },
  };

  const normalizedFigure = normalizeFigure(figure);
  if (normalizedFigure) {
    next.figure = normalizedFigure;
  }

  return next;
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
    [componentTypeColumn]: TARGET_COMPONENT,
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
    select: ["id", "bonusContent"],
    populate: {
      images: {
        populate: ["image", "mobileImage"],
      },
      dynamicContent: {
        populate: "*",
      },
    },
  });

  let updated = 0;
  let skipped = 0;

  for (const slot of slots) {
    const bonusBlocks = normalizeBlocks(slot.bonusContent);
    const thirdFigure =
      Array.isArray(slot.images) && slot.images.length > 2
        ? slot.images[2]
        : null;

    strapiInstance.log.info(
      `[debug] slot.id=${slot.id} images[2]=${JSON.stringify(thirdFigure)}`,
    );
    strapiInstance.log.info(
      `[debug] slot.id=${slot.id} normalizeFigure(images[2])=${JSON.stringify(normalizeFigure(thirdFigure))}`,
    );

    const hasBonus = bonusBlocks.length > 0;
    const hasFigure = normalizeFigure(thirdFigure) !== null;

    if (!hasBonus && !hasFigure) {
      skipped += 1;
      continue;
    }

    if (
      hasEquivalentParagraphWithFigure(
        slot.dynamicContent,
        bonusBlocks,
        thirdFigure,
      )
    ) {
      skipped += 1;
      continue;
    }

    const nextComponent = buildParagraphWithFigure(bonusBlocks, thirdFigure);
    delete nextComponent.__component;

    const createdComponent = await createComponentEntry(
      strapiInstance,
      TARGET_COMPONENT,
      nextComponent,
    );

    await appendDynamicZoneComponent(
      strapiInstance,
      slot.id,
      createdComponent.id,
    );

    updated += 1;
  }

  strapiInstance.log.info(
    `[slot migration] Appended ${updated} paragraph-with-figure blocks from bonusContent/images[2]; skipped ${skipped}.`,
  );
}

module.exports = { up };
