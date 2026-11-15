'use strict';

// Log every @AuraEnabled call the page makes, from the network layer, so it survives reloads and needs no
// in-page patching. Aura reports Apex errors as HTTP 200, so read each action's state, never the status.
function record(s) {
  const calls = [];
  const listener = async (request) => {
    const response = await request.response();
    if (!/\/aura\?.*ApexAction\.execute/.test(request.url())) return;
    let actions = [];
    try {
      const message = new URLSearchParams(request.postData() || '').get('message');
      actions = JSON.parse(message).actions;
      const body = JSON.parse((await response.text()).replace(/^while\(1\);\s*/, ''));
      for (const a of actions) {
        const out = (body.actions || []).find((x) => x.id === a.id) || {};
        calls.push({
          classname: a.params.classname, method: a.params.method, params: a.params.params,
          state: out.state, returnValue: out.returnValue, error: out.error, ms: Math.round(request.timing().responseEnd),
        });
      }
    } catch (e) {
      calls.push({ classname: '?', method: '?', state: 'UNPARSED', error: String(e).slice(0, 200) });
    }
  };
  s.page.on('requestfinished', listener);
  return {
    calls,
    stop: () => s.page.off('requestfinished', listener),
  };
}

module.exports = { record };
