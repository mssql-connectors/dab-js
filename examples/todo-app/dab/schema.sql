IF DB_ID('TodoApp') IS NULL
BEGIN
    CREATE DATABASE TodoApp;
END;
GO

USE TodoApp;
GO

IF OBJECT_ID('dbo.Todos') IS NULL
BEGIN
    CREATE TABLE dbo.Todos
    (
        id uniqueidentifier NOT NULL
            CONSTRAINT PK_Todos PRIMARY KEY
            CONSTRAINT DF_Todos_Id DEFAULT NEWID(),
        title nvarchar(200) NOT NULL,
        completed bit NOT NULL CONSTRAINT DF_Todos_Completed DEFAULT 0,
        createdAt datetime2 NOT NULL CONSTRAINT DF_Todos_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO
