package com.iflytek.bigdata.flint.metadata.controller;

import com.github.pagehelper.PageInfo;
import com.iflytek.bigdata.flint.common.dto.Response;
import com.iflytek.bigdata.flint.metadata.dao.model.MetadataProfileColumn;
import com.iflytek.bigdata.flint.metadata.service.IMetadataProfileColumnService;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import org.springframework.web.bind.annotation.*;

import javax.annotation.Resource;

@RestController
@Api(value = "画像标签接口")
@CrossOrigin(origins = "*")
@RequestMapping("/iflytek/flint/metadata/profile/label")
public class MetadataProfileColumnController {

    @Resource
    private IMetadataProfileColumnService IMetadataProfileColumnService;

    @ApiOperation(value = "画像标签", notes = "画像标签")
    @GetMapping("/list")
    @ResponseBody
    public Response list(@RequestParam(value = "name", required = false) String name,
            @RequestParam(value = "showName", required = false) String showName,
            @RequestParam(value = "pageNum", required = false, defaultValue = "1") int pageNum,
            @RequestParam(value = "pageSize", required = false, defaultValue = "15") int pageSize) {
        MetadataProfileColumn metadataProfileColumn = new MetadataProfileColumn();
        metadataProfileColumn.setName(name);
        metadataProfileColumn.setShowName(showName);
        PageInfo<MetadataProfileColumn> pageInfo = IMetadataProfileColumnService.selectByPage(metadataProfileColumn, pageNum, pageSize);
        return new Response(pageInfo);
    }

    @ApiOperation(value = "画像标签详情", notes = "画像标签详情")
    @GetMapping("/detail")
    @ResponseBody
    public Response detail(Integer id) {
        MetadataProfileColumn item = IMetadataProfileColumnService.selectById(id);
        return new Response(item);
    }

    @ApiOperation(value = "画像标签新增", notes = "画像标签新增")
    @PostMapping("/insert")
    @ResponseBody
    public Response insert(@RequestHeader(value = "ldapUsername", required = false) String operator, @RequestBody MetadataProfileColumn item) {
        IMetadataProfileColumnService.insert(item);
        return new Response("操作成功");
    }

    @ApiOperation(value = "画像标签修改", notes = "画像标签修改")
    @PostMapping("/update")
    @ResponseBody
    public Response update(@RequestHeader(value = "ldapUsername", required = false) String operator, @RequestBody MetadataProfileColumn item) {
        IMetadataProfileColumnService.insert(item);
        return new Response("操作成功");
    }

    @ApiOperation(value = "画像标签删除", notes = "画像标签删除")
    @RequestMapping(value = "/delete", method = RequestMethod.DELETE)
    @ResponseBody
    public Response delete(Integer id) {
        MetadataProfileColumn item = IMetadataProfileColumnService.selectById(id);
        if (item != null) {
            IMetadataProfileColumnService.delete(id);
            return new Response("操作成功");
        }
        return new Response(200, "删除失败");
    }
}
