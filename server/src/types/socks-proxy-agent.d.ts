// TODO(tech-debt): Remove after server migrates to moduleResolution node16/nodenext.
declare module 'socks-proxy-agent' {
  import { Agent, AgentOptions } from 'node:http';
  import { URL } from 'node:url';

  export class SocksProxyAgent extends Agent {
    constructor(uri: string | URL, opts?: AgentOptions);
  }
}
