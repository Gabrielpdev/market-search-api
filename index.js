const express = require("express");
const puppeteer = require("puppeteer-extra");
// const puppeteer = require("puppeteer-core");
// const chromium = require("@sparticuz/chromium");

const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const AdblockerPlugin = require("puppeteer-extra-plugin-adblocker");
puppeteer.use(AdblockerPlugin({ blockTrackers: true }));

const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

app.get("/products", async (req, res) => {
  const searchParams = req.query;
  const query = searchParams.search || "";

  if (!query) return res.json({ error: "No product query provided" });

  const options = {
    headless: false, // process.env['DISPLAY'] = ':0'; in index.js, xorg running.
    ignoreDefaultArgs: true, // needed ?
    devtools: false, // not needed so far, we can see websocket frames and xhr responses without that.
    //dumpio: true,
    defaultViewport: {
      //--window-size in args
      width: 1280,
      height: 882,
    },
    args: [
      /* TODO : https://peter.sh/experiments/chromium-command-line-switches/
    there is still a whole bunch of stuff to disable
  */
      //'--crash-test', // Causes the browser process to crash on startup, useful to see if we catch that correctly
      // not idea if those 2 aa options are usefull with disable gl thingy
      "--disable-canvas-aa", // Disable antialiasing on 2d canvas
      "--disable-2d-canvas-clip-aa", // Disable antialiasing on 2d canvas clips
      "--disable-gl-drawing-for-tests", // BEST OPTION EVER! Disables GL drawing operations which produce pixel output. With this the GL output will not be correct but tests will run faster.
      "--disable-dev-shm-usage", // ???
      "--no-zygote", // wtf does that mean ?
      "--use-gl=swiftshader", // better cpu usage with --use-gl=desktop rather than --use-gl=swiftshader, still needs more testing.
      "--enable-webgl",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--disable-infobars",
      "--disable-breakpad",
      //'--ignore-gpu-blacklist',
      "--window-size=1280,1024", // see defaultViewport
      "--user-data-dir=./chromeData", // created in index.js, guess cache folder ends up inside too.
      "--no-sandbox", // meh but better resource comsuption
      "--disable-setuid-sandbox",
    ], // same
    // '--proxy-server=socks5://127.0.0.1:9050'] // tor if needed
  };

  const browser = await puppeteer.launch(options);

  // args: [...chrome.args, "--hide-scrollbars", "--disable-web-security"],
  //     defaultViewport: chrome.defaultViewport,
  //     executablePath: await chrome.executablePath,
  //     headless: true,
  //     ignoreHTTPSErrors: true,

  // const browser = await puppeteer.launch({
  //   args: [
  //     "--disable-setuid-sandbox",
  //     "--no-sandbox",
  //     "--single-process",
  //     "--no-zygote",
  //     "--hide-scrollbars",
  //     "--disable-web-security",
  //   ],
  //   executablePath:
  //     process.env.NODE_ENV === "production"
  //       ? process.env.PUPPETEER_EXECUTABLE_PATH
  //       : puppeteer.executablePath(),
  //   ignoreHTTPSErrors: true,
  //   // headless: true,
  //   headless: false,
  // });

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
  const page = await browser.newPage();

  await page.setRequestInterception(true);

  page.on("request", (request) => {
    if (
      ["image", "stylesheet", "font"].indexOf(request.resourceType()) !== -1
    ) {
      request.abort();
    } else {
      request.continue();
    }
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
      page.$eval(
        ".fotorama__stage__frame",
        (el) => el.getAttribute("href") || "/no-image.png"
      ),
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

  await page.setRequestInterception(true);

  page.on("request", (request) => {
    if (
      ["image", "stylesheet", "font"].indexOf(request.resourceType()) !== -1
    ) {
      request.abort();
    } else {
      request.continue();
    }
  });

  await page.goto(`https://www.giassi.com.br/${search}?map=ft&_q=${search}`);

  const productList = await page.$$(".vtex-search-result-3-x-galleryItem");
  const products = [];

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
