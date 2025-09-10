package com.iflytek.bigdata.flint.analysis.service;

import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistory;
import com.iflytek.bigdata.flint.analysis.dto.FunnelAnalysisDto;
import com.iflytek.bigdata.flint.analysis.dto.FunnelResultDto;

/**
 * 漏斗分析Service接口
 * @Author: xuhao
 * @Date: 2025/8/15
 * @Desc: 漏斗分析业务逻辑接口
 */
public interface IFunnelAnalysisService {

    /**
     * 创建漏斗分析查询
     * @param operator 操作者
     * @param funnelAnalysisDto 漏斗分析参数
     * @param cache 是否缓存
     * @return 查询历史记录
     */
    ImpalaQueryHistory createFunnelQuery(String operator, FunnelAnalysisDto funnelAnalysisDto, Integer cache);

    /**
     * 获取漏斗分析结果
     * @param id 查询历史ID
     * @return 漏斗分析结果
     */
    FunnelResultDto getFunnelResultByHistoryId(Long id);

    /**
     * 验证漏斗分析参数
     * @param funnelAnalysisDto 漏斗分析参数
     * @return 验证结果
     */
    boolean validateFunnelAnalysisParams(FunnelAnalysisDto funnelAnalysisDto);

    /**
     * 计算漏斗转化率
     * @param stepValues 各步骤数值
     * @return 转化率列表
     */
    java.util.List<Double> calculateConversionRates(java.util.List<Long> stepValues);

    /**
     * 生成漏斗分析SQL示例
     * @param funnelAnalysisDto 漏斗分析参数
     * @return SQL语句
     */
    String generateFunnelSqlExample(FunnelAnalysisDto funnelAnalysisDto);
} 