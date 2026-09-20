IF DB_ID('Library') IS NULL
BEGIN
    CREATE DATABASE Library;
END;
GO

USE Library;
GO

DROP TABLE IF EXISTS dbo.Books;
GO

CREATE TABLE dbo.Books
(
    id int NOT NULL PRIMARY KEY,
    title nvarchar(200) NOT NULL,
    [year] int NULL,
    pages int NULL
);
GO

INSERT INTO dbo.Books (id, title, [year], pages) VALUES
    (1000, 'Practical Azure SQL Database for Modern Developers', 2020, 326),
    (1001, 'SQL Server 2019 Revealed', 2019, 444),
    (1002, 'Azure SQL Revealed', 2020, 528),
    (1003, 'SQL Server 2022 Revealed', 2022, 506);
GO
