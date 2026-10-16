const mangayomiSources = [
  {
    "name": "Meosss",
    "lang": "vi",
    "baseUrl": "https://meosss.com",
    "apiUrl": "",
    "iconUrl": "https://meosss.com/wp-content/uploads/2026/04/cropped-MzUOZRfMIv1BjPjCwKeiSpTYupVpfFEGI3s23FVX-192x192.webp",
    "typeSource": "single",
    "itemType": 0,
    "version": "0.0.3",
    "pkgPath": "manga/src/vi/meosss.js",
    "isNsfw": true
  }
];

// Site WordPress dùng theme "init-manga".
//  - Danh sách: /moi-cap-nhat/page/{n}/, /bo-loc-nang-cao/page/{n}/?sort=views
//  - Truyện:    /truyen/{slug}/   (danh sách chương phân trang: /truyen/{slug}/chap/page/{n}/)
//  - Chương:    /truyen/{slug}/chap-{số}/  (ảnh trong #chapter-content, host cdn.meosss.com)
//  - Tìm kiếm:  GET /wp-json/initlise/v1/search?term=...  (JSON)
class DefaultExtension extends MProvider {
  constructor() {
    super();
    this.client = new Client();
  }

  // ---------- helpers ----------

  getHeaders(url) {
    return {
      "Referer": this.source.baseUrl + "/",
      "User-Agent":
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36"
    };
  }

  // Sửa lỗi font: nếu app giải mã nhầm UTF-8 thành Latin-1/cp1252 (vd "Ã¡" thay vì "á")
  // thì đổi ngược về byte rồi giải mã lại UTF-8. Chuỗi đã đúng thì giữ nguyên.
  fixEncoding(s) {
    if (!s || !/[\u00C2\u00C3\u00C4\u00C6\u00E1][\u0080-\u00BF\u0152-\u2122]/.test(s)) return s;
    const cp = {0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};
    try {
      let bin = "";
      for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (cp[c] !== undefined) c = cp[c];
        if (c > 255) return s; // có ký tự thật ngoài Latin-1 => chuỗi không bị lỗi kiểu này
        bin += String.fromCharCode(c);
      }
      return decodeURIComponent(escape(bin));
    } catch (e) {
      return s;
    }
  }

  absUrl(u) {
    if (!u) return "";
    if (u.startsWith("http")) return u;
    if (u.startsWith("//")) return "https:" + u;
    return this.source.baseUrl + (u.startsWith("/") ? u : "/" + u);
  }

  relPath(u) {
    return this.absUrl(u).replace(this.source.baseUrl, "");
  }

  // Link truyện dạng /truyen/{slug}/ (không phải chương, không phải trang chỉ mục /truyen/)
  isMangaLink(path) {
    if (!path.startsWith("/truyen/")) return false;
    if (path.includes("/chap")) return false;
    const rest = path.replace("/truyen/", "").replace(/\/$/, "");
    return rest.length > 0 && !rest.includes("/");
  }

  // Parser chung cho mọi trang danh sách: lấy các thẻ <a> bọc ảnh bìa trong .manga-block
  parseList(html, page) {
    const doc = new Document(html);
    const list = [];
    const seen = {};
    for (const a of doc.select("div.manga-block a")) {
      const img = a.selectFirst("img");
      if (!img) continue;
      const link = this.relPath(a.attr("href"));
      if (!this.isMangaLink(link) || seen[link]) continue;
      seen[link] = true;
      const alt = (img.attr("alt") || "").replace("Ảnh bìa của ", "").trim();
      list.push({
        name: alt,
        link: link,
        imageUrl: this.absUrl(img.attr("src"))
      });
    }
    // "Trang sau" không bị uk-disabled => còn trang tiếp
    let hasNextPage = false;
    for (const li of doc.select("ul.uk-pagination li")) {
      const a = li.selectFirst("a");
      if (!a) continue;
      if (a.attr("aria-label") === "Trang sau" && !(li.className || "").includes("uk-disabled")) {
        hasNextPage = true;
      }
    }
    return { list, hasNextPage };
  }

  async getListPage(path) {
    const res = await this.client.get(this.source.baseUrl + path, this.getHeaders());
    return this.parseList(this.fixEncoding(res.body));
  }

  // ---------- list endpoints ----------

  async getPopular(page) {
    const path = page > 1 ? "/bo-loc-nang-cao/page/" + page + "/?sort=views" : "/bo-loc-nang-cao/?sort=views";
    return await this.getListPage(path);
  }

  get supportsLatest() {
    return true;
  }

  async getLatestUpdates(page) {
    const path = page > 1 ? "/moi-cap-nhat/page/" + page + "/" : "/moi-cap-nhat/";
    return await this.getListPage(path);
  }

  // API tìm kiếm trực tiếp của theme: trả về mảng JSON, không phân trang
  async search(query, page, filters) {
    if (page > 1) return { list: [], hasNextPage: false };
    const url = this.source.baseUrl + "/wp-json/initlise/v1/search?term=" + encodeURIComponent(query);
    const res = await this.client.get(url, this.getHeaders());
    const items = JSON.parse(this.fixEncoding(res.body));
    const list = [];
    for (const it of items) {
      if (it.post_type && it.post_type !== "manga") continue;
      list.push({
        name: (it.title || "").replace(/<[^>]+>/g, "").trim(),
        link: this.relPath(it.url),
        imageUrl: it.thumb || ""
      });
    }
    return { list, hasNextPage: false };
  }

  // ---------- detail ----------

  parseChapters(doc, out, seen) {
    for (const row of doc.select("#chapter-list div.chapter-item")) {
      const a = row.selectFirst("a");
      if (!a) continue;
      const url = this.relPath(a.attr("href"));
      if (seen[url]) continue;
      seen[url] = true;
      // Tiêu đề bị cắt kiểu "Tên Truyện […] – Chap 12" => lấy phần sau " – "
      let name = (row.selectFirst("h3") ? row.selectFirst("h3").text : a.text).trim();
      const idx = name.lastIndexOf("–");
      if (idx >= 0) name = name.substring(idx + 1).trim();
      const timeEl = row.selectFirst("time");
      let dateUpload = String(new Date().getTime());
      if (timeEl && timeEl.attr("datetime")) {
        const t = Date.parse(timeEl.attr("datetime"));
        if (!isNaN(t)) dateUpload = String(t);
      }
      out.push({ name, url, dateUpload, scanlator: "" });
    }
  }

  async getDetail(url) {
    const fullUrl = this.absUrl(url);
    const res = await this.client.get(fullUrl, this.getHeaders());
    const doc = new Document(this.fixEncoding(res.body));

    const titleEl = doc.selectFirst("#manga-title");
    const name = titleEl ? titleEl.text.trim() : "";

    const coverEl = doc.selectFirst("a.story-cover img");
    const imageUrl = coverEl ? this.absUrl(coverEl.attr("src")) : "";

    const descEl = doc.selectFirst("#manga-description");
    const description = descEl ? descEl.text.trim() : "";

    let author = "";
    const view = doc.selectFirst("#view-comic");
    if (view) {
      const authors = [];
      for (const a of view.select("a[href*='/tac-gia/']")) authors.push(a.text.trim());
      author = authors.join(", ");
    }

    const genre = [];
    for (const g of doc.select("#genre-tags a")) genre.push(g.text.trim());

    // Truyện hoàn thành có nhãn "END" trong khối thông tin
    let status = 0;
    if (view) {
      for (const s of view.select("span.uk-text-small")) {
        if (s.text.trim().toUpperCase() === "END") status = 1;
      }
    }

    // Chương: trang 1 nằm ngay trong trang truyện, các trang sau ở /chap/page/{n}/
    const chapters = [];
    const seen = {};
    this.parseChapters(doc, chapters, seen);

    let maxPage = 1;
    for (const a of doc.select("#chapter-list ul.uk-pagination a")) {
      const m = (a.attr("href") || "").match(/\/chap\/page\/(\d+)\//);
      if (m && parseInt(m[1]) > maxPage) maxPage = parseInt(m[1]);
    }
    const base = fullUrl.replace(/\/$/, "");
    for (let p = 2; p <= maxPage; p++) {
      const r = await this.client.get(base + "/chap/page/" + p + "/", this.getHeaders());
      this.parseChapters(new Document(this.fixEncoding(r.body)), chapters, seen);
    }

    return {
      name,
      imageUrl,
      author,
      description,
      genre,
      status,
      chapters,
      link: fullUrl
    };
  }

  // ---------- reader ----------

  // Ảnh trang nằm sẵn trong HTML trong #chapter-content. Có 2 dạng:
  //  - ảnh đầu (eager):   <img src="https://.../0001.jpg">
  //  - ảnh sau (lazy):    <img data-original-src="https://.../0002.jpg" src="data:image/svg+xml,...">
  // => phải ưu tiên data-original-src; src của ảnh lazy chỉ là ảnh giữ chỗ (data: URI).
  async getPageList(url) {
    const res = await this.client.get(this.absUrl(url), this.getHeaders());
    const doc = new Document(this.fixEncoding(res.body));
    const pages = [];
    const seen = {};
    for (const img of doc.select("#chapter-content img")) {
      const candidates = [
        img.attr("data-original-src"),
        img.attr("data-src"),
        img.attr("data-lazy-src"),
        img.attr("data-original"),
        img.attr("src")
      ];
      let src = "";
      for (const c of candidates) {
        if (c && c.trim().startsWith("http")) {
          src = c.trim();
          break;
        }
      }
      if (!src || seen[src]) continue;
      seen[src] = true;
      pages.push({ url: src, headers: { "Referer": this.source.baseUrl + "/" } });
    }
    return pages;
  }

  getFilterList() {
    return [];
  }

  getSourcePreferences() {
    return [];
  }
}
