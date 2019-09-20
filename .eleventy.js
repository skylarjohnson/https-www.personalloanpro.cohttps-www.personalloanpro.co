const fs = require('fs');

const date = require('date-and-time');
const nunjucks = require('nunjucks');
const { dirname, basename } = require('path');
const createSchedule = require('./src/schedule/script/create-schedule');

const {
  utcOffset,
  path: confboxPath,
  extraSchedule,
} = require('./lib/confbox-config');

function dateStrToTimestamp(dateStr) {
  const result = date.parse(dateStr, 'YYYY/MM/DD HH:mm', true);
  if (isNaN(result)) {
    throw new TypeError(
      `Invalid date. Must be in the format YYYY/MM/DD HH:mm'. Found: ${dateStr}`,
    );
  }
  return result.valueOf() - utcOffset;
}

function buildScheduleData(sessions, speakers) {
  const schedule = [
    ...sessions.map(session => ({
      start: session.data.start,
      end: session.data.end,
      title: session.data.title,
      speakers: session.data.speakers,
      topics: session.data.topics,
      session: true,
      fileSlug: session.fileSlug,
      body: session.data.description,
    })),
    ...extraSchedule.map(obj => ({ ...obj })),
  ].map(item => {
    // Convert dates to timestamps
    item.start = dateStrToTimestamp(item.start);
    item.end = dateStrToTimestamp(item.end);

    if (item.icon) {
      item.icon = `confboxAsset(${item.icon})`;
    }

    if (item.speakers) {
      item.speakers = item.speakers.map(speakerId => {
        const speaker = speakers.find(s => s.fileSlug == speakerId);
        if (!speaker) throw new Error(`Could not find speaker: ${speakerId}`);
        return {
          name: speaker.data.name,
          avatar: `confboxAsset(${speaker.data.avatar ||
            '/assets/speakers/default.svg'})`,
        };
      });
    }

    return item;
  });

  schedule.sort((a, b) => (a.start < b.start ? -1 : 1));

  return schedule;
}

class ModularClassName {
  constructor(output) {
    this._output = output;
    this._cache = new Map();
  }
  _getData(css) {
    if (!css.startsWith('/')) {
      throw new TypeError('CSS path must be absolute (starts with /)');
    }

    if (!this._cache.has(css)) {
      const file = this._output + css + '.json';
      const json = fs.readFileSync(file, {
        encoding: 'utf8',
      });
      this._cache.set(css, JSON.parse(json));
    }

    return this._cache.get(css);
  }
  getClassName(css, className) {
    const data = this._getData(css);

    if (!(className in data)) {
      throw new TypeError(`Cannot find className "${className}" in ${css}`);
    }

    return data[className];
  }
  getAllCamelCased(css) {
    const output = {};
    const data = this._getData(css);

    for (const [key, val] of Object.entries(data)) {
      output[key.replace(/-\w/g, match => match[1].toUpperCase())] = val;
    }

    return output;
  }
}

module.exports = function(eleventyConfig) {
  const config = {
    dir: {
      input: 'src',
      output: '.build-tmp',
    },
    pathPrefix: confboxPath,
  };

  const modCSS = new ModularClassName(config.dir.output);

  /** Get a class name from a CSS module */
  eleventyConfig.addShortcode('className', (css, className) => {
    return modCSS.getClassName(css, className);
  });

  const cssPerPage = new Map();

  // This is to hack around https://github.com/11ty/eleventy/issues/638
  eleventyConfig.addShortcode('pageStart', page => {
    cssPerPage.set(page.url, new Set());
    return '';
  });

  eleventyConfig.addShortcode(
    'speakerAttr',
    (collections, speakerId, attr, fallback) => {
      const speaker = collections.speakers.find(speaker =>
        speaker.inputPath.endsWith(`/${speakerId}.md`),
      );
      if (!speaker) {
        throw Error(`Unknown speaker ${speakerId}`);
      }
      return new nunjucks.runtime.SafeString(speaker.data[attr] || fallback);
    },
  );

  /** Add some CSS, deduping anything along the way */
  eleventyConfig.addShortcode('css', (page, url) => {
    if (!cssPerPage.has(page.url)) {
      cssPerPage.set(page.url, new Set());
    }

    const set = cssPerPage.get(page.url);

    if (set.has(url)) return '';
    set.add(url);

    return new nunjucks.runtime.SafeString(
      `<style>confboxInline(confboxAsset(${url}))</style>`,
    );
  });

  eleventyConfig.addShortcode('headingSlug', str => {
    return new nunjucks.runtime.SafeString(
      str.replace(
        /\s/g,
        () =>
          `<span class=${modCSS.getClassName(
            '/_includes/module.css',
            'slug-dash',
          )}></span>`,
      ),
    );
  });

  eleventyConfig.addShortcode('idify', str => {
    return str.toLowerCase().replace(/\s/g, '-');
  });

  eleventyConfig.addShortcode('schedule', (sessions, speakers) => {
    return new nunjucks.runtime.SafeString(
      createSchedule(
        buildScheduleData(sessions, speakers),
        utcOffset,
        modCSS.getAllCamelCased('/schedule/style.css'),
        confboxPath,
      ),
    );
  });

  function confDate(timestamp, format) {
    if (typeof timestamp === 'string') {
      timestamp = new Date(timestamp);
    }
    const offsetTime = new Date(timestamp.valueOf() + utcOffset);
    return date.format(offsetTime, format);
  }
  /** Format a date in the timezone of the conference */
  eleventyConfig.addShortcode('confDate', confDate);

  eleventyConfig.addShortcode('confDateMinutesIfNotZero', timestamp => {
    const string = confDate(timestamp, 'mm');
    if (string === '00') {
      return '';
    }
    return ':' + string;
  });

  eleventyConfig.addShortcode('confDateAmPm', timestamp => {
    const string = confDate(timestamp, 'A');
    return string.replace(/\./g, '');
  });

  /** Dump JSON data in a way that's safe to be output in HTML */
  eleventyConfig.addShortcode('json', obj => {
    return JSON.stringify(obj)
      .replace(/<!--/g, '<\\!--')
      .replace(/<script/g, '<\\script')
      .replace(/<\/script/g, '<\\/script');
  });

  /** Get an ISO 8601 version of a date */
  eleventyConfig.addShortcode('isoDate', timestamp => {
    return new Date(timestamp.valueOf()).toISOString();
  });

  eleventyConfig.addCollection('faqs', collection => {
    const faqs = collection
      .getFilteredByTag('faq')
      .sort((a, b) => (a.inputPath < b.inputPath ? -1 : 1));

    const sections = [];
    let section;

    for (const faq of faqs) {
      const folder = basename(dirname(faq.data.page.inputPath));
      if (!section || section.folder !== folder || faq.data.question) {
        section = {
          title: faq.data.question ? faq.data.title : faq.data.sectionTitle,
          question: faq.data.question
            ? faq.data.question
            : faq.data.sectionQuestion,
          answer: faq.data.question ? faq.data.answer : faq.data.sectionAnswer,
          folder,
          items: [],
        };
        sections.push(section);
      }

      section.items.push(faq);
    }

    return sections;
  });

  eleventyConfig.addCollection('jsSchedule', collection => {
    return buildScheduleData(
      collection.getFilteredByTag('session'),
      collection.getFilteredByTag('speakers'),
    );
  });

  return config;
};
