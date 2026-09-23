IF DB_ID('ChatApp') IS NULL
BEGIN
    CREATE DATABASE ChatApp;
END;
GO

DECLARE @password nvarchar(128) = N'$(DAB_CHAT_PASSWORD)';
DECLARE @statement nvarchar(max);

IF EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'dab_chat')
BEGIN
    SET @statement = N'ALTER LOGIN [dab_chat] WITH PASSWORD = '
        + QUOTENAME(@password, '''') + N';';
END;
ELSE
BEGIN
    SET @statement = N'CREATE LOGIN [dab_chat] WITH PASSWORD = '
        + QUOTENAME(@password, '''') + N', CHECK_POLICY = ON;';
END;

EXEC (@statement);
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

IF USER_ID('dab_chat') IS NULL
BEGIN
    CREATE USER [dab_chat] FOR LOGIN [dab_chat];
END;
GO

GRANT SELECT, INSERT, DELETE ON dbo.Messages TO [dab_chat];
GRANT VIEW DEFINITION ON dbo.Messages TO [dab_chat];
DENY UPDATE ON dbo.Messages TO [dab_chat];
GO
