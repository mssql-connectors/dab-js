IF DB_ID('ChatApp') IS NULL
BEGIN
    CREATE DATABASE ChatApp;
END;
GO

USE ChatApp;
GO

IF OBJECT_ID('dbo.Messages') IS NULL
BEGIN
    CREATE TABLE dbo.Messages
    (
        id uniqueidentifier NOT NULL
            CONSTRAINT PK_Messages PRIMARY KEY
            CONSTRAINT DF_Messages_Id DEFAULT NEWID(),
        author nvarchar(50) NOT NULL,
        body nvarchar(1000) NOT NULL,
        createdAt datetime2 NOT NULL
            CONSTRAINT DF_Messages_CreatedAt DEFAULT SYSUTCDATETIME()
    );
END;
GO
