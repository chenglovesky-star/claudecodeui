package com.iflytek.bigdata.flint.analysis.controller;

import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistory;
import com.iflytek.bigdata.flint.analysis.dao.model.ImpalaQueryHistoryWithBLOBs;
import com.iflytek.bigdata.flint.analysis.dto.EventDetailDto;
import com.iflytek.bigdata.flint.analysis.dto.ResultDto;
import com.iflytek.bigdata.flint.analysis.service.IImpalaQueryHistoryService;
import com.iflytek.bigdata.flint.analysis.thread.AnalysisQueryStatusEnum;
import com.iflytek.bigdata.flint.analysis.utils.AnalysisUtil;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dto.PropertyDto;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import javax.servlet.http.HttpServletResponse;
import java.util.List;

/**
 * @Author: linlong
 * @Date: 2024/8/5
 * @Desc:
 */
@RestController
@Api(value = "事件分析接口")
@RequestMapping("/iflytek/flint/analysis")
public class AnalysisEventController {


    @Resource
    private AnalysisUtil analysisUtil;

    @Resource
    private IImpalaQueryHistoryService iImpalaQueryHistoryService;


    @ApiOperation(value = "按属性查看列表", notes = "按属性查看列表")
    @GetMapping("/event/groupBy/property")
    @ResponseBody
    public Response groupByProperty(String events) {
        List<PropertyDto> propertyDtos = analysisUtil.groupByPropertyList(events);
        return new Response(propertyDtos);
    }

    @ApiOperation(value = "事件分析查询提交", notes = "事件分析查询提交")
    @PostMapping("/event/query")
    @ResponseBody
    public Response query(@RequestHeader(value = "ldapUsername") String operator,
                          @RequestBody EventDetailDto eventDetailDto) {
        Integer cache = eventDetailDto.getCache();
        if (cache == null) cache = 1;
        ImpalaQueryHistory impalaQueryHistory = analysisUtil.createQuery(operator, eventDetailDto, cache);
        eventDetailDto.setId(impalaQueryHistory.getId());
        return new Response(impalaQueryHistory);
    }

    @ApiOperation(value = "事件分析查询结果", notes = "事件分析查询结果")
    @GetMapping("/event/query/result")
    @ResponseBody
    public Response result(Long id) {
        ImpalaQueryHistoryWithBLOBs impalaQueryHistory = iImpalaQueryHistoryService.selectStatusAndMessage(id);
        if (impalaQueryHistory.getStatus() == AnalysisQueryStatusEnum.ERROR.getIndex()) {
            return new Response(1, "查询报错，请联系管理员(龙林)", impalaQueryHistory.getMessage());
        }
        if (impalaQueryHistory.getStatus() == AnalysisQueryStatusEnum.FINISHED.getIndex()) {
            ResultDto resultDto = analysisUtil.getResultByHistoryId(id, false);
            return new Response(resultDto);
        } else {
            return new Response(0, "RUNNING");
        }

    }

    @ApiOperation(value = "事件分析查询结果导出", notes = "事件分析查询结果导出")
    @RequestMapping(value = "/event/query/result/export", method = RequestMethod.GET)
    public void export(HttpServletResponse response, @RequestParam Long id) {
        analysisUtil.exportQueryResult(response, id);
    }
}

