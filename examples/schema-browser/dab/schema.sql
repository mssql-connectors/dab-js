IF DB_ID('SchemaBrowser') IS NULL
BEGIN
    CREATE DATABASE SchemaBrowser;
END;
GO

USE SchemaBrowser;
GO

CREATE SCHEMA sales;
GO
CREATE SCHEMA inventory;
GO
CREATE SCHEMA catalog;
GO

CREATE TABLE sales.Customers
(
    CustomerId int IDENTITY PRIMARY KEY,
    DisplayName nvarchar(120) NOT NULL,
    Email varchar(254) NULL,
    CreatedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME()
);
GO

CREATE TABLE inventory.Products
(
    ProductId int IDENTITY PRIMARY KEY,
    Sku varchar(32) NOT NULL UNIQUE,
    ProductName nvarchar(160) NOT NULL,
    UnitPrice decimal(12, 2) NOT NULL,
    IsActive bit NOT NULL DEFAULT 1
);
GO

CREATE TABLE sales.Orders
(
    OrderId bigint IDENTITY PRIMARY KEY,
    CustomerId int NOT NULL,
    OrderedAt datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    Status varchar(24) NOT NULL,
    CONSTRAINT FK_Orders_Customers
        FOREIGN KEY (CustomerId) REFERENCES sales.Customers(CustomerId)
);
GO

CREATE TABLE sales.OrderLines
(
    OrderId bigint NOT NULL,
    LineNumber int NOT NULL,
    ProductId int NOT NULL,
    Quantity int NOT NULL,
    UnitPrice decimal(12, 2) NOT NULL,
    LineTotal AS Quantity * UnitPrice,
    CONSTRAINT PK_OrderLines PRIMARY KEY (OrderId, LineNumber),
    CONSTRAINT FK_OrderLines_Orders
        FOREIGN KEY (OrderId) REFERENCES sales.Orders(OrderId) ON DELETE CASCADE,
    CONSTRAINT FK_OrderLines_Products
        FOREIGN KEY (ProductId) REFERENCES inventory.Products(ProductId)
);
GO

CREATE VIEW sales.ActiveOrders
AS
    SELECT OrderId, CustomerId, OrderedAt, Status
    FROM sales.Orders
    WHERE Status <> 'Closed';
GO

CREATE VIEW catalog.DatabaseObjects
AS
    SELECT
        o.object_id AS objectId,
        s.name AS schemaName,
        o.name AS objectName,
        CASE o.type WHEN 'U' THEN 'TABLE' ELSE 'VIEW' END AS objectType,
        COUNT(c.column_id) AS columnCount,
        o.create_date AS createDate,
        o.modify_date AS modifyDate
    FROM sys.objects AS o
    INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
    LEFT JOIN sys.columns AS c ON c.object_id = o.object_id
    WHERE o.type IN ('U', 'V')
      AND o.is_ms_shipped = 0
      AND s.name <> 'catalog'
    GROUP BY o.object_id, s.name, o.name, o.type, o.create_date, o.modify_date;
GO

CREATE VIEW catalog.DatabaseColumns
AS
    SELECT
        c.object_id AS objectId,
        c.column_id AS columnId,
        c.name AS columnName,
        t.name AS dataType,
        c.max_length AS maxLength,
        c.precision AS precisionValue,
        c.scale AS scaleValue,
        c.is_nullable AS isNullable,
        c.is_identity AS isIdentity,
        c.is_computed AS isComputed,
        CONVERT(bit, CASE WHEN pk.column_id IS NULL THEN 0 ELSE 1 END) AS isPrimaryKey,
        dc.definition AS defaultDefinition
    FROM sys.columns AS c
    INNER JOIN sys.types AS t ON t.user_type_id = c.user_type_id
    INNER JOIN sys.objects AS o ON o.object_id = c.object_id
    INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
    LEFT JOIN sys.default_constraints AS dc ON dc.object_id = c.default_object_id
    LEFT JOIN
    (
        SELECT ic.object_id, ic.column_id
        FROM sys.indexes AS i
        INNER JOIN sys.index_columns AS ic
            ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        WHERE i.is_primary_key = 1
    ) AS pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
    WHERE o.type IN ('U', 'V')
      AND o.is_ms_shipped = 0
      AND s.name <> 'catalog';
GO

CREATE VIEW catalog.DatabaseIndexes
AS
    SELECT
        i.object_id AS objectId,
        i.index_id AS indexId,
        i.name AS indexName,
        i.type_desc AS indexType,
        i.is_unique AS isUnique,
        i.is_primary_key AS isPrimaryKey,
        i.is_disabled AS isDisabled,
        STRING_AGG(CONVERT(nvarchar(max), c.name), ', ')
            WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns
    FROM sys.indexes AS i
    INNER JOIN sys.objects AS o ON o.object_id = i.object_id
    INNER JOIN sys.schemas AS s ON s.schema_id = o.schema_id
    INNER JOIN sys.index_columns AS ic
        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
    INNER JOIN sys.columns AS c
        ON c.object_id = ic.object_id AND c.column_id = ic.column_id
    WHERE i.index_id > 0
      AND i.is_hypothetical = 0
      AND o.is_ms_shipped = 0
      AND s.name <> 'catalog'
    GROUP BY i.object_id, i.index_id, i.name, i.type_desc,
        i.is_unique, i.is_primary_key, i.is_disabled;
GO

CREATE VIEW catalog.DatabaseRelationships
AS
    SELECT
        fk.object_id AS foreignKeyId,
        fkc.constraint_column_id AS columnOrdinal,
        fk.name AS foreignKeyName,
        fk.parent_object_id AS parentObjectId,
        parentSchema.name AS parentSchema,
        parentTable.name AS parentTable,
        parentColumn.name AS parentColumn,
        fk.referenced_object_id AS referencedObjectId,
        referencedSchema.name AS referencedSchema,
        referencedTable.name AS referencedTable,
        referencedColumn.name AS referencedColumn,
        fk.delete_referential_action_desc AS deleteAction,
        fk.update_referential_action_desc AS updateAction
    FROM sys.foreign_keys AS fk
    INNER JOIN sys.foreign_key_columns AS fkc
        ON fkc.constraint_object_id = fk.object_id
    INNER JOIN sys.tables AS parentTable
        ON parentTable.object_id = fk.parent_object_id
    INNER JOIN sys.schemas AS parentSchema
        ON parentSchema.schema_id = parentTable.schema_id
    INNER JOIN sys.columns AS parentColumn
        ON parentColumn.object_id = fkc.parent_object_id
        AND parentColumn.column_id = fkc.parent_column_id
    INNER JOIN sys.tables AS referencedTable
        ON referencedTable.object_id = fk.referenced_object_id
    INNER JOIN sys.schemas AS referencedSchema
        ON referencedSchema.schema_id = referencedTable.schema_id
    INNER JOIN sys.columns AS referencedColumn
        ON referencedColumn.object_id = fkc.referenced_object_id
        AND referencedColumn.column_id = fkc.referenced_column_id;
GO

CREATE LOGIN dab_schema_reader WITH PASSWORD = 'DabSchema_reader_2025!';
GO
CREATE USER dab_schema_reader FOR LOGIN dab_schema_reader;
GO
GRANT VIEW DEFINITION TO dab_schema_reader;
GRANT SELECT ON SCHEMA::catalog TO dab_schema_reader;
GO
