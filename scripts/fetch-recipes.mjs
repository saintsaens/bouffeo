import { Client } from "@notionhq/client";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const DATABASE_ID = "7d8e11d6-e294-47f5-af73-cd14e33039f3";
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "../src/data/recipes.json");

const notion = new Client({ auth: process.env.NOTION_TOKEN });

function slugify(str) {
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function plainText(richText) {
  return (richText ?? []).map((t) => t.plain_text).join("").trim();
}

function parseServings(text) {
  const match = (text ?? "").match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 4;
}

async function fetchIngredients(ingredientsDbId) {
  const res = await notion.databases.query({ database_id: ingredientsDbId, page_size: 100 });
  const ingredients = [];

  for (const row of res.results) {
    const nombre = row.properties.Nombre?.number;
    const alimantRelation = row.properties.Aliments?.relation ?? [];
    if (!alimantRelation.length) continue;

    const aliment = await notion.pages.retrieve({ page_id: alimantRelation[0].id });
    const name = plainText(aliment.properties.Nom?.title);
    if (name) {
      ingredients.push({ amount: String(nombre ?? ""), name });
    }
  }

  return ingredients;
}

async function parseRecipePage(page) {
  const title = plainText(page.properties.Nom?.title);
  const servings = parseServings(plainText(page.properties["Quantité "]?.rich_text));

  const blocks = await notion.blocks.children.list({ block_id: page.id, page_size: 100 });

  let ingredients = [];
  const steps = [];
  let inSteps = false;

  for (const block of blocks.results) {
    if (block.type === "child_database" && block.child_database?.title?.trim() === "Ingrédients") {
      ingredients = await fetchIngredients(block.id);
      inSteps = false;
      continue;
    }

    if (block.type === "heading_1") {
      const text = plainText(block.heading_1?.rich_text);
      inSteps = text.toLowerCase().includes("étape") || text.toLowerCase().includes("etape");
      continue;
    }

    if (inSteps && block.type === "numbered_list_item") {
      const text = plainText(block.numbered_list_item?.rich_text);
      if (text) steps.push(text);
    }
  }

  return { slug: slugify(title), title, servings, ingredients, steps };
}

async function main() {
  if (!process.env.NOTION_TOKEN) {
    console.error("Missing NOTION_TOKEN environment variable");
    process.exit(1);
  }

  const res = await notion.databases.query({ database_id: DATABASE_ID, page_size: 100 });
  console.log(`Found ${res.results.length} entries`);

  const recipes = [];
  for (const page of res.results) {
    const title = plainText(page.properties.Nom?.title);
    console.log(`Processing: ${title}`);
    const recipe = await parseRecipePage(page);
    recipes.push(recipe);
    console.log(`  ✓ ${recipe.ingredients.length} ingredients, ${recipe.steps.length} steps`);
  }

  writeFileSync(OUT_PATH, JSON.stringify(recipes, null, 2));
  console.log(`\nWrote ${recipes.length} recipes to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
