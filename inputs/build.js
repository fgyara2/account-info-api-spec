const { YAML } = require('swagger-parser'); // eslint-disable-line
const yaml = require('js-yaml'); // eslint-disable-line
const SwaggerParser = require('swagger-parser'); // eslint-disable-line
const fs = require('fs');
const { typeFor, collapseAllOf } = require('./utils');
const { removeAllOf } = require('./remove-all-of');

const readYaml = file => YAML.parse(fs.readFileSync(file));

const fileListToObject = (items, dir) => {
  const obj = {};
  items.forEach(file => Object.assign(obj, readYaml(`${dir}/${file.$ref}`)));
  return obj;
};

const importSection = (api, dir, section) => {
  console.log(`section: ${section}`);
  const items = api[section];
  console.log(`${YAML.stringify(items)}`);
  const obj = fileListToObject(items, dir);
  api[section] = obj; // eslint-disable-line
};

const importPaths = (api, dir) => {
  for (const path in api.paths) { // eslint-disable-line
    const items = api.paths[path];
    console.log(`path: ${path}`);
    console.log(`${YAML.stringify(items)}`);
    const obj = fileListToObject(items, dir);
    api.paths[path] = obj; // eslint-disable-line
  }
};

const writeOutput = (outFile, api) => {
  const path = outFile.split('/');
  path.pop();
  const outDir = path.join('/');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir);
  }
  fs.writeFileSync(`${outFile}.yaml`, yaml.safeDump(api, { noRefs: true }));
  fs.writeFileSync(`${outFile}.json`, JSON.stringify(api, null, 2));
};

const writeDereferenced = (outFile, api) => {
  const out = JSON.parse(JSON.stringify(api));
  fs.writeFileSync(`${outFile}.yaml`, YAML.stringify(out));
};

const logE = (e) => {
  console.log(e.message); // eslint-disable-line
  console.log(Object.keys(e)); // eslint-disable-line
  console.log(e); // eslint-disable-line
};

const deduplicateRequestResponse = (api, req, res) => {
  if (api.definitions[req] && api.definitions[res]) {
    const request = api.definitions[req];
    const response = api.definitions[res];
    Object.keys(request.properties).forEach((p) => {
      const match = request.properties[p].description === response.properties[p].description;
      if (match) {
        delete response.properties[p];
      }
    });
    request.required.forEach((r) => {
      const index = response.required.indexOf(r);
      if (index !== -1) {
        response.required.splice(index, 1);
      }
    });
    const newSchema = { // eslint-disable-line
      allOf: [
        { $ref: `#/definitions/${req}` },
        { properties: response.properties },
        { required: response.required },
      ],
    };
    api.definitions[res] = newSchema; // eslint-disable-line
  }
};

const sortKeys = (obj) => {
  collapseAllOf(obj);
  Object.keys(obj).sort().forEach((key) => {
    const value = obj[key];
    delete obj[key]; // eslint-disable-line
    obj[key] = value; // eslint-disable-line
    const type = typeFor(value);
    if (type === 'object') {
      sortKeys(value);
    } else if (type === 'array') {
      const itemType = typeFor(value[0]);
      if (itemType === 'string') {
        value.sort();
      } else if (itemType === 'object' && value[0].name) {
        value.sort((a, b) => a.name.localeCompare(b.name));
      }
      value.forEach((item) => {
        if (typeFor(item) === 'object') { sortKeys(item); }
      });
    }
  });
  return obj;
};

const cloneApi = api => JSON.parse(JSON.stringify(api));

const process = async (file) => {
  try {
    const dir = file.replace('/index.yaml', '');
    const api = readYaml(file);
    importPaths(api, dir);
    importSection(api, dir, 'definitions');
    importSection(api, dir, 'parameters');
    importSection(api, dir, 'responses');
    importSection(api, dir, 'securityDefinitions');
    deduplicateRequestResponse(api, 'OBReadData1', 'OBReadDataResponse1');
    const { version } = api.info;
    console.log('VALIDATE');
    const valid = await SwaggerParser.validate(cloneApi(api));
    console.log('API name: %s, Version: %s', valid.info.title, version);
    writeOutput(`./dist/${version}/account-info-swagger-with-allof`, api);

    const withoutAllOf = await removeAllOf(api);
    writeOutput(`./dist/${version}/account-info-swagger`, withoutAllOf);

    const deref = await SwaggerParser.dereference(cloneApi(api));
    delete deref.definitions;
    delete deref.parameters;
    const successes = Object.keys(deref.responses).filter(k => k.startsWith('20'));
    successes.forEach(k => delete deref.responses[k]);
    writeDereferenced(`./dist/${version}/account-info-swagger-dereferenced`, sortKeys(deref));

    const old = await SwaggerParser.dereference(readYaml('./dist/v1.1/account-info-swagger.yaml'));
    writeDereferenced('./dist/v1.1/account-info-swagger-dereferenced', sortKeys(old));
  } catch (e) {
    logE(e); // eslint-disable-line
  }
};

try {
  const versions = fs.readdirSync('./inputs').filter(d => d.startsWith('v'));

  versions.forEach(version =>
    process(`./inputs/${version}/accounts/index.yaml`));
} catch (e) {
  logE(e); // eslint-disable-line
}
