import hive from 'hive-driver';

const { TCLIService, TCLIService_types } = hive.thrift;
const { PlainTcpAuthentication } = hive.auth;
const { TcpConnection } = hive.connections;

// 配置
const HIVE_HOST = process.env.HIVE_HOST || '10.100.106.17';
const HIVE_PORT = parseInt(process.env.HIVE_PORT || '10010', 10);
const HIVE_USER = process.env.HIVE_USER || 'sr';
const HIVE_PASSWORD = process.env.HIVE_PASSWORD || 'iflytek';
const HIVE_DATABASE = process.env.HIVE_DATABASE || 'ossp';
const HIVE_DOMAIN = process.env.HIVE_DOMAIN || 'claudeweb';
const HIVE_USER_TABLE = process.env.HIVE_USER_TABLE || 'default_catalog.dw_meta.meta_user';

let client = null;
let session = null;
let connectingPromise = null;

async function ensureSession() {
  if (session) return session;
  if (connectingPromise) return connectingPromise;

  connectingPromise = (async () => {
  try {
    const connection = new TcpConnection();
    const auth = new PlainTcpAuthentication({ username: HIVE_USER, password: HIVE_PASSWORD });
    client = new hive.HiveClient(TCLIService, TCLIService_types);

    await client.connect(
      { host: HIVE_HOST, port: HIVE_PORT },
      connection,
      auth
    );

    session = await client.openSession({
      client_protocol: TCLIService_types.TProtocolVersion.HIVE_CLI_SERVICE_PROTOCOL_V11,
      configuration: {
        'kyuubi.session.domain': HIVE_DOMAIN,
        'use:database': HIVE_DATABASE
      }
    });

    console.log(`[HIVE] Connected to ${HIVE_HOST}:${HIVE_PORT}, domain=${HIVE_DOMAIN}`);
    return session;
  } catch (err) {
    client = null;
    session = null;
    throw err;
  } finally {
    connectingPromise = null;
  }
  })();

  return connectingPromise;
}

function resetConnection() {
  try {
    if (session) session.close().catch(() => {});
    if (client) client.close();
  } catch (_) {}
  session = null;
  client = null;
}

/**
 * 查询 meta_user 表验证用户
 * @param {string} username
 * @param {string} password
 * @returns {Promise<{username: string, role: string, status: number} | null>}
 */
async function verifyUser(username, password) {
  // 白名单校验防止 SQL 注入
  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    return null;
  }

  let retried = false;
  while (true) {
    try {
      const sess = await ensureSession();
      const escapedUsername = username.replace(/'/g, "\\'");
      const sql = `SELECT username, password, role, status FROM ${HIVE_USER_TABLE} WHERE username='${escapedUsername}' AND status=1 LIMIT 1`;

      const operation = await sess.executeStatement(sql, { runAsync: true });

      // 等待查询完成（超时 10s）
      const startTime = Date.now();
      let finished = false;
      while (Date.now() - startTime < 10000) {
        const status = await operation.status();
        if (status.operationState === TCLIService_types.TOperationState.FINISHED_STATE) {
          finished = true;
          break;
        }
        if (status.operationState === TCLIService_types.TOperationState.ERROR_STATE) {
          await operation.close();
          throw new Error('Hive query error');
        }
        await new Promise(r => setTimeout(r, 300));
      }

      if (!finished) {
        await operation.close().catch(() => {});
        throw new Error('Hive query timeout');
      }

      // 获取结果
      operation.setMaxRows(1);
      operation.setFetchType(TCLIService_types.TFetchOrientation.FETCH_NEXT);
      const chunk = await operation.nextFetch();
      await operation.close();

      const columns = chunk.results?.columns;
      if (!columns || !columns[0]?.stringVal?.values?.length) {
        return null; // 用户不存在
      }

      const hiveUsername = columns[0].stringVal.values[0];
      const hivePassword = columns[1].stringVal.values[0];
      const hiveRole = columns[2].stringVal.values[0];
      const hiveStatus = columns[3].i32Val.values[0];

      // 转 Buffer 为字符串
      const uname = Buffer.isBuffer(hiveUsername) ? hiveUsername.toString() : hiveUsername;
      const pwd = Buffer.isBuffer(hivePassword) ? hivePassword.toString() : hivePassword;
      const role = Buffer.isBuffer(hiveRole) ? hiveRole.toString() : hiveRole;

      // 明文密码比对
      if (pwd !== password) {
        return null;
      }

      return { username: uname, role, status: hiveStatus };
    } catch (err) {
      if (!retried) {
        retried = true;
        console.warn('[HIVE] Query failed, reconnecting:', err.message);
        resetConnection();
        continue;
      }
      console.error('[HIVE] verifyUser failed after retry:', err.message);
      throw err;
    }
  }
}

export { verifyUser };
