const express = require("express");
// const puppeteer = require("puppeteer");
const puppeteer = require("puppeteer-extra");

const cors = require("cors");

require("dotenv").config();

// export interface IProduct {
//   productName: null | string;
//   price: null | number;
//   img: string;
//   market: string;
// }

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

app.get("/", async (req, res) => {
  res.send("Express on Vercel");
});

app.get("/products", async (req, res) => {
  const searchParams = req.query;
  const query = searchParams.search || "";

  if (!query) return res.json({ error: "No product query provided" });

  // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)
  const StealthPlugin = require("puppeteer-extra-plugin-stealth");
  puppeteer.use(StealthPlugin());

  // Add adblocker plugin, which will transparently block ads in all pages you
  // create using puppeteer.
  const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
  puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

  const browser = await puppeteer.launch({
    args: [
      "--disable-setuid-sandbox",
      "--no-sandbox",
      "--single-process",
      "--no-zygote",
    ],
    executablePath:
      process.env.NODE_ENV === "production"
        ? process.env.PUPPETEER_EXECUTABLE_PATH
        : puppeteer.executablePath(),
    headless: false,
  });

  const [kompraoProducts, giassiProducts] = await Promise.all([
    getProductsOnKomprao(query, browser),
    getProductsOnGiassi(query, browser),
  ]);
  await browser.close();

  const allData = [...kompraoProducts, ...giassiProducts];

  const sortedData = allData
    .filter(
      (product) =>
        product?.productName?.toLowerCase().indexOf(query.toLowerCase()) !== -1
    )
    .sort((a, b) => {
      if (a.productName && b.productName && a.price && b.price) {
        return (
          a.productName.toLowerCase().indexOf(query.toLowerCase()) -
            b.productName.toLowerCase().indexOf(query.toLowerCase()) ||
          a.price - b.price
        );
      }

      return 0;
    });

  res.json({ data: sortedData });
});

async function getProductsOnKomprao(search, browser) {
  let page = await browser.newPage();

  page.on("request", (request) => {
    if (
      request.resourceType() === "image" ||
      request.resourceType() === "stylesheet"
    )
      request.abort();
    else request.continue();
  });

  const response = await page.goto(
    `https://www.superkoch.com.br/catalogsearch/result/?q=${search}`,
    { waitUntil: "domcontentloaded" }
  );
  const chain = response?.request().redirectChain();

  if (chain && chain.length === 1) {
    const url = chain[0].url();

    await page.goto(url, { waitUntil: "domcontentloaded" });

    const products = [];
    let productObj = {
      productName: null,
      price: null,
      market: "Komprao",
      img: "/no-image.png",
    };

    const [price, productName, img] = await Promise.allSettled([
      page.$eval(".price", (el) => el.textContent || "N/A"),
      page.$eval(".page-title", (el) => el.textContent || "N/A"),
      page.$eval(".fotorama__stage__frame", (el) => {
        console.log(el);
        return el.getAttribute("href") || "/no-image.png";
      }),
    ]);

    if (productName.status === "fulfilled") {
      productObj.productName = productName.value;
    } else {
      productObj.productName = null;
    }

    if (price.status === "fulfilled") {
      productObj.price = productObj.price = Number(
        price.value.replace(/[^0-9,-]+/g, "").replace(",", ".")
      );
    } else {
      productObj.price = null;
    }

    if (img.status === "fulfilled") {
      productObj.img = img.value;
    } else {
      productObj.img = "/no-image.png";
    }

    products.push(productObj);

    await browser.close();

    return products;
  }

  const productList = await page.$$(".product-item");
  const products = [];

  for (let product of productList) {
    let productObj = {
      productName: null,
      price: null,
      img: "/no-image.png",
      market: "Komprao",
    };

    const [price, productName, img] = await Promise.allSettled([
      product.$eval(".price", (el) => el.textContent),
      product.$eval(".product-item-link", (el) => el.textContent),
      product.$eval(
        ".product-image-photo",
        (el) => el.getAttribute("src") || "/no-image.png"
      ),
    ]);

    if (productName.status === "fulfilled") {
      productObj.productName = productName.value;
    } else {
      productObj.productName = null;
    }

    if (price.status === "fulfilled" && price.value) {
      productObj.price = Number(
        price.value.replace(/[^0-9,-]+/g, "").replace(",", ".")
      );
    } else {
      productObj.price = null;
    }

    if (img.status === "fulfilled") {
      productObj.img = img.value;
    } else {
      productObj.img = "/no-image.png";
    }

    products.push(productObj);
  }

  return products;
}

async function getProductsOnGiassi(search, browser) {
  const page = await browser.newPage();

  page.on("request", (request) => {
    if (
      request.resourceType() === "image" ||
      request.resourceType() === "stylesheet"
    )
      request.abort();
    else request.continue();
  });

  await page.goto(`https://www.giassi.com.br/${search}?map=ft&_q=${search}`);

  const productList = await page.$$(".vtex-search-result-3-x-galleryItem");
  const products = [];

  await page.screenshot({
    path: "div.png",
  });
  // co;nsole.log(productList)

  for (let product of productList) {
    let productObj = {
      market: "Giassi",
      productName: null,
      price: null,
      img: "/no-image.png",
    };

    const [brand, price, promo, img, priceTotalUnit] = await Promise.allSettled(
      [
        product.$eval(
          ".vtex-product-summary-2-x-productBrand",
          (el) => el.textContent
        ),
        product.$eval(
          ".giassi-apps-custom-0-x-priceUnit",
          (el) => el.textContent
        ),
        product.$eval(
          ".giassi-apps-custom-0-x-pricePerKG",
          (el) => el.textContent
        ),
        product.$eval(
          ".vtex-product-summary-2-x-imageNormal",
          (el) => el.getAttribute("src") || "/no-image.png"
        ),
        product.$eval(
          ".giassi-apps-custom-0-x-priceTotalUnit",
          (el) => el.textContent
        ),
      ]
    );

    if (brand.status === "fulfilled") {
      productObj.productName = brand.value;
    } else {
      productObj.productName = null;
    }

    if (price.status === "fulfilled" && price.value) {
      productObj.price = Number(
        price.value.replace(/[^0-9,-]+/g, "").replace(",", ".")
      );
    } else {
      productObj.price = null;
    }

    if (img.status === "fulfilled") {
      productObj.img = img.value;
    } else {
      productObj.img = "/no-image.png";
    }

    if (priceTotalUnit.status === "fulfilled" && priceTotalUnit.value) {
      productObj.price = Number(
        priceTotalUnit.value.replace(/[^0-9,-]+/g, "").replace(",", ".")
      );
    }

    if (promo.status === "fulfilled" && promo.value) {
      productObj.price = Number(
        promo.value.replace(/[^0-9,-]+/g, "").replace(",", ".")
      );
    }

    products.push(productObj);
  }

  return products;
}

app.listen(port, () => {
  console.log(`[server]: Server is running at http://localhost:${port}`);
});

module.exports = app;
