use robotech::macros::api_doc;

/// # 网关实例 OpenAPI 文档
///
/// 逐个列出要进 Swagger 的接口。`#[api_doc]` **不会**自动枚举 handler，
/// 漏写就是文档里没有——新增接口时要同步加到这里。
#[api_doc(
    add,
    modify,
    save,
    upsert,
    sync,
    del_by_id,
    del_by_query_dto,
    get_by_id,
    get_ex_by_id,
    get_by_query_dto,
    count_by_query_dto,
    get_ex_by_query_dto,
    list_by_query_dto,
    list_ex_by_query_dto,
    page_by_query_dto,
    page_ex_by_query_dto,
    search_by_id,
    search_by_condition,
    search_list,
    search_page,
    search_ex_by_id,
    search_ex_by_condition,
    search_list_ex,
    search_page_ex
)]
pub struct UiamGatewayApiDoc;
