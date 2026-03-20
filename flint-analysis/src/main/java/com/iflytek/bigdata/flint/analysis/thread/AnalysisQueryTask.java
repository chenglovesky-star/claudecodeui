package com.iflytek.bigdata.flint.analysis.thread;

import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryResultWithBLOBs;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryHistoryService;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryResultService;
import com.iflytek.bigdata.flint.hiveserver2.config.HiveConfig;


import java.util.*;
import java.util.concurrent.*;

public class AnalysisQueryTask implements Runnable {

    private String queryContent;

    private IImpalaQueryResultService iImpalaQueryResultService;

    private IImpalaQueryHistoryService iImpalaQueryHistoryService;


    private String jdbcType;

    private String hiveEngine;

    private long queryHistoryId;

    private HiveConfig hiveConfig;

    public void setHiveConfig(HiveConfig hiveConfig) {
        this.hiveConfig = hiveConfig;
    }

    public String getHiveEngine() {
        return hiveEngine;
    }

    public void setHiveEngine(String hiveEngine) {
        this.hiveEngine = hiveEngine;
    }

    public void setJdbcType(String jdbcType) {
        this.jdbcType = jdbcType;
    }

    public void setiImpalaQueryHistoryService(IImpalaQueryHistoryService iImpalaQueryHistoryService) {
        this.iImpalaQueryHistoryService = iImpalaQueryHistoryService;
    }

    public void setQueryContent(String queryContent) {
        this.queryContent = queryContent;
    }

    public void setiImpalaQueryResultService(IImpalaQueryResultService iImpalaQueryResultService) {
        this.iImpalaQueryResultService = iImpalaQueryResultService;
    }


    public long getQueryHistoryId() {
        return queryHistoryId;
    }

    public void setQueryHistoryId(long queryHistoryId) {
        this.queryHistoryId = queryHistoryId;
    }

    @Override
    public void run() {
        runSync();
    }

    private void runSync() {
        ExecutorService es = null;
        try {
            String[] arrs = queryContent.split(";");
            List<JSONArray> resultList = new ArrayList<>(arrs.length);
            es = Executors.newFixedThreadPool(arrs.length);
            CompletionService<String> cs = new ExecutorCompletionService<>(es);
            Map<String, Integer> sortMap = new HashMap<>();
            for (int i = 0; i < arrs.length; i++) {
                resultList.add(null);
                sortMap.put(i + "###" + arrs[i], i);
                AnalysisWorker worker = new AnalysisWorker(hiveConfig, i + "###" + arrs[i], this.queryHistoryId,
                        jdbcType, hiveEngine);
                cs.submit(worker);
                Thread.sleep(5000L);
            }
            es.shutdown();
            while (!es.isTerminated()) {
                Thread.sleep(1000L);
            }
            for (int i = 0; i < arrs.length; i++) {
                Future<String> future = cs.take();
                String result = future.get();
                JSONObject rs = JSONObject.parseObject(result);
                String sql = rs.getString("sql");
                JSONArray result1 = rs.getJSONArray("result");
                resultList.set(sortMap.get(sql), result1);
            }
            this.success(this.queryHistoryId, JSONArray.toJSONString(resultList));
        } catch (Exception ex) {
            this.error(this.queryHistoryId, ex.getMessage());
            es.shutdownNow();
        } finally {
            AnalysisThreadPool.stopThread(this.queryHistoryId);
        }
    }

    private void success(long id, String result) {
        Date now = new Date();
        ImpalaQueryResultWithBLOBs impalaQueryResultWithBLOBs = iImpalaQueryResultService.selectByHistoryId(id);
        if (impalaQueryResultWithBLOBs != null) {
            impalaQueryResultWithBLOBs.setOriginResult(result);
        }
        iImpalaQueryResultService.update(impalaQueryResultWithBLOBs);
        ImpalaQueryHistoryWithBLOBs impalaQueryHistoryWithBLOBs = iImpalaQueryHistoryService.selectById(id);
        if (impalaQueryHistoryWithBLOBs != null) {
            impalaQueryHistoryWithBLOBs.setEndTime(now);
            impalaQueryHistoryWithBLOBs.setStatus(AnalysisQueryStatusEnum.FINISHED.getIndex());
            impalaQueryHistoryWithBLOBs
                    .setPeriod((now.getTime() - impalaQueryHistoryWithBLOBs.getStartTime().getTime()) / 1000);
            iImpalaQueryHistoryService.update(impalaQueryHistoryWithBLOBs);
        }
        Long seconds = (now.getTime() - impalaQueryHistoryWithBLOBs.getStartTime().getTime()) / (1000);
        if (seconds > 120L) {
//            FeishuMessageUtil.sendMetricToFeishu("事件分析查询[ID:" + impalaQueryHistoryWithBLOBs.getId()
//                            + "]执行成功，请前往METIS查询管理[查看结果](https://ark.gotoiflytek.com/metis/analysis/event?id=" + impalaQueryHistoryWithBLOBs.getId() + "&type=analysis&status=0)！",
//                    impalaQueryHistoryWithBLOBs.getUsername());
        }
    }

    private void error(long id, String message) {
        ImpalaQueryHistoryWithBLOBs impalaQueryHistoryWithBLOBs = iImpalaQueryHistoryService.selectById(id);
        if (!impalaQueryHistoryWithBLOBs.getStatus().equals(AnalysisQueryStatusEnum.RUNNING.getIndex())) return;
        if (impalaQueryHistoryWithBLOBs != null) {
            impalaQueryHistoryWithBLOBs.setEndTime(new Date());
            if ("sleep interrupted".equalsIgnoreCase(message) || message.contains("cancelled job")) {
                message = "cancelled job";
                impalaQueryHistoryWithBLOBs.setStatus(AnalysisQueryStatusEnum.ABORTED.getIndex());
            } else {
                impalaQueryHistoryWithBLOBs.setStatus(AnalysisQueryStatusEnum.ERROR.getIndex());
            }
            impalaQueryHistoryWithBLOBs.setMessage(message);
            iImpalaQueryHistoryService.update(impalaQueryHistoryWithBLOBs);
        }
    }

}


