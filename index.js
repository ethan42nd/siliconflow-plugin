import fs from 'node:fs';

if (!global.segment) {
  global.segment = (await import("oicq")).segment;
}

let ret = [];

logger.info(logger.yellow("[sf插件] 正在载入 siliconflow-PLUGIN"));

const files = fs
  .readdirSync('./plugins/siliconflow-plugin/apps')
  .filter((file) => file.endsWith('.js'));

files.forEach((file) => {
  ret.push(import(`./apps/${file}`))
})

ret = await Promise.allSettled(ret);

let apps = {};
for (let i in files) {
  let name = files[i].replace('.js', '');

  if (ret[i].status !== 'fulfilled') {
    logger.error(`[sf插件] 载入插件错误：${logger.red(name)}`);
    logger.error(ret[i].reason);
    continue;
  }
  
  // 优先使用 default 导出，如果没有则使用第一个命名导出
  const module = ret[i].value;
  if (module.default) {
    apps[name] = module.default;
  } else {
    apps[name] = module[Object.keys(module)[0]];
  }
}

logger.info(logger.green("[sf插件] siliconflow-PLUGIN 载入成功"));

export { apps };