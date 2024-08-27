package com.iflytek.bigdata.flint.metadata.controller;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.Dim;
import com.iflytek.bigdata.flint.metadata.dao.model.DimColumn;
import com.iflytek.bigdata.flint.metadata.dto.DimDto;
import com.iflytek.bigdata.flint.metadata.service.IDimColumnService;
import com.iflytek.bigdata.flint.metadata.service.IDimService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;
import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

@RestController
@Api(value = "维度表接口")
@CrossOrigin(origins = "*")
@RequestMapping("/iflytek/flint/metadata/dim")
public class DimController {

    @Resource
    private IDimService iDimService;

    @Resource
    private IDimColumnService iDimColumnService;

    @ApiOperation(value = "维度表列表", notes = "维度表列表")
    @GetMapping("/list")
    @ResponseBody
    public Response list(@RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "hiveTableName", required = false) String hiveTableName,
            @RequestParam(value = "pageNum", required = false, defaultValue = "1") int pageNum,
            @RequestParam(value = "pageSize", required = false, defaultValue = "15") int pageSize) {
        Dim dim = new Dim();
        dim.setName(name);
        dim.setHiveTableName(hiveTableName);
        PageInfo<Dim> pageInfo = iDimService.selectByPage(dim, pageNum, pageSize);
        return new Response(pageInfo);
    }

    @ApiOperation(value = "维度表详情", notes = "维度表详情")
    @GetMapping("/detail")
    @ResponseBody
    public Response detail(Integer id) {
        DimDto item = new DimDto();
        Dim dim = iDimService.selectById(id);
        item.setId(dim.getId());
        item.setName(dim.getName());
        item.setHiveTableName(dim.getHiveTableName());
        item.setDimColumn(dim.getDimColumn());
        item.setEvent(dim.getEvent());
        item.setProperty(dim.getProperty());
        item.setPartition(dim.getPartition());
        DimColumn search = new DimColumn();
        search.setDimId(dim.getId());
        List<DimColumn> list = iDimColumnService.select(search);
        item.setDimColumnList(list);
        return new Response(item);
    }

    @ApiOperation(value = "维度表详情新增", notes = "维度表详情新增")
    @PostMapping("/insert")
    @ResponseBody
    public Response insert(@RequestHeader(value = "ldapUsername", required = false, defaultValue = "admin") String operator, @RequestBody DimDto item) {
        Dim dim = new Dim();
        dim.setName(item.getName());
        dim.setHiveTableName(item.getHiveTableName());
        dim.setDimColumn(item.getDimColumn());
        dim.setEvent(item.getEvent());
        dim.setProperty(item.getProperty());
        dim.setCreateTime(new Date());
        dim.setUpdateTime(new Date());
        dim.setUsername(operator);
        dim.setStatus(1);
        dim.setPartition(item.getPartition());
        iDimService.insert(dim);
        if (CollectionUtils.isNotEmpty(item.getDimColumnList())) {
            for (DimColumn dimColumn : item.getDimColumnList()) {
                dimColumn.setDimId(dim.getId());
                iDimColumnService.insert(dimColumn);
            }
        }
        return new Response("操作成功");
    }

    @ApiOperation(value = "维度表详情修改", notes = "维度表详情修改")
    @PostMapping("/update")
    @ResponseBody
    public Response update(@RequestHeader(value = "ldapUsername", required = false, defaultValue = "admin") String operator, @RequestBody DimDto item) {
        Dim dim = new Dim();
        dim.setId(item.getId());
        dim.setName(item.getName());
        dim.setHiveTableName(item.getHiveTableName());
        dim.setDimColumn(item.getDimColumn());
        dim.setEvent(item.getEvent());
        dim.setProperty(item.getProperty());
        dim.setUpdateTime(new Date());
        dim.setUsername(operator);
        dim.setStatus(1);
        dim.setPartition(item.getPartition());
        iDimService.update(dim);
        DimColumn search = new DimColumn();
        search.setDimId(dim.getId());
        List<DimColumn> list = iDimColumnService.select(search);
        Set<Integer> ids = new HashSet<>();
        if (CollectionUtils.isNotEmpty(item.getDimColumnList())) {
            for (DimColumn dimColumn : item.getDimColumnList()) {
                dimColumn.setDimId(dim.getId());
                if (dimColumn.getId() == null) {
                    iDimColumnService.insert(dimColumn);
                } else {
                    iDimColumnService.update(dimColumn);
                    ids.add(dimColumn.getId());
                }
            }
        }
        for (DimColumn dimColumn : list) {
            if (!ids.contains(dimColumn.getId())) {
                iDimColumnService.delete(dimColumn.getDimId());
            }
        }
        return new Response("操作成功");
    }

    @ApiOperation(value = "删除", notes = "删除")
    @RequestMapping(value = "/delete", method = RequestMethod.DELETE)
    @ResponseBody
    public Response delete(Integer id) {
        iDimService.delete(id);
        DimColumn search = new DimColumn();
        search.setDimId(id);
        List<DimColumn> list = iDimColumnService.select(search);
        if (CollectionUtils.isNotEmpty(list)) {
            for (DimColumn dimColumn : list) {
                iDimColumnService.delete(dimColumn.getDimId());
            }
        }
        return new Response(0, "删除成功");
    }
}
