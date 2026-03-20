package com.iflytek.bigdata.flint.analysis.controller;

import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistory;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dto.FunnelAnalysisDto;
import com.iflytek.bigdata.flint.analysis.dto.FunnelResultDto;
import com.iflytek.bigdata.flint.analysis.service.IFunnelAnalysisService;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryHistoryService;
import com.iflytek.bigdata.flint.analysis.thread.AnalysisQueryStatusEnum;
import com.iflytek.bigdata.flint.analysis.utils.FunnelAnalysisUtil;
import com.iflytek.bigdata.flint.common.dto.Response;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import lombok.extern.log4j.Log4j2;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.io.IOException;

/**
 * 漏斗分析Controller
 * @Author: xuhao
 * @Date: 2025/8/15
 * @Desc: 漏斗分析相关接口
 */
@RestController
@CrossOrigin(origins = "*")
@Api(value = "漏斗分析接口")
@RequestMapping("/iflytek/flint/funnel")
@Log4j2
public class FunnelAnalysisController {

    @Resource
    private IFunnelAnalysisService funnelAnalysisService;

    @Resource
    private IImpalaQueryHistoryService impalaQueryHistoryService;

    @Resource
    private FunnelAnalysisUtil funnelAnalysisUtil;

    @ApiOperation(value = "漏斗分析查询提交", notes = "漏斗分析查询提交")
    @PostMapping("/query")
    @ResponseBody
    public Response query(@RequestHeader(value = "ldapUsername", required = false, defaultValue = "admin") String operator,
                         @RequestBody FunnelAnalysisDto funnelAnalysisDto) {
        try {
            Integer cache = funnelAnalysisDto.getCache();
            if (cache == null) cache = 1;
            
            ImpalaQueryHistory impalaQueryHistory = funnelAnalysisService.createFunnelQuery(operator, funnelAnalysisDto, cache);
            funnelAnalysisDto.setId(impalaQueryHistory.getId());
            
            return new Response(impalaQueryHistory);
        } catch (Exception e) {
            log.error("漏斗分析查询提交失败", e);
            return new Response(1, "查询提交失败：" + e.getMessage());
        }
    }

    @ApiOperation(value = "漏斗分析查询结果", notes = "漏斗分析查询结果")
    @GetMapping("/query/result")
    @ResponseBody
    public Response result(@RequestParam Long id) {
        try {
            ImpalaQueryHistoryWithBLOBs impalaQueryHistory = impalaQueryHistoryService.selectStatusAndMessage(id);
            
            if (impalaQueryHistory == null) {
                return new Response(1, "查询历史记录不存在");
            }
            
            if (impalaQueryHistory.getStatus() == AnalysisQueryStatusEnum.ERROR.getIndex()) {
                return new Response(1, "查询报错，请联系管理员", impalaQueryHistory.getMessage());
            }
            
            if (impalaQueryHistory.getStatus() == AnalysisQueryStatusEnum.FINISHED.getIndex()) {
                FunnelResultDto resultDto = funnelAnalysisService.getFunnelResultByHistoryId(id);
                if (resultDto != null) {
                    return new Response(resultDto);
                } else {
                    return new Response(1, "查询结果为空");
                }
            } else {
                return new Response(0, "RUNNING");
            }
        } catch (Exception e) {
            log.error("获取漏斗分析结果失败", e);
            return new Response(1, "获取结果失败：" + e.getMessage());
        }
    }

    @ApiOperation(value = "漏斗分析查询结果导出", notes = "漏斗分析查询结果导出")
    @RequestMapping(value = "/query/result/export", method = RequestMethod.GET)
    public void export(HttpServletResponse response, @RequestParam Long id) {
        try {
            // 调用工具类导出漏斗分析结果
            funnelAnalysisUtil.exportFunnelAnalysisResult(response, id);
        } catch (Exception e) {
            log.error("漏斗分析结果导出失败", e);
            try {
                response.setContentType("text/plain;charset=utf-8");
                response.getWriter().write("导出失败：" + e.getMessage());
            } catch (IOException ex) {
                log.error("写入错误信息失败", ex);
            }
        }
    }

    @ApiOperation(value = "生成漏斗分析SQL示例", notes = "用于调试和验证SQL生成逻辑")
    @PostMapping("/sql/example")
    @ResponseBody
    public Response generateSqlExample(@RequestBody FunnelAnalysisDto funnelAnalysisDto) {
        try {
            String sql = funnelAnalysisService.generateFunnelSqlExample(funnelAnalysisDto);
            return new Response(sql);
        } catch (Exception e) {
            log.error("生成漏斗分析SQL示例失败", e);
            return new Response(1, "生成SQL失败：" + e.getMessage());
        }
    }

} 